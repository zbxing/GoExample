package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"go/ast"
	"go/format"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

const snapshotSchemaVersion = 1

var modulePattern = regexp.MustCompile(`(?m)^module\s+(\S+)\s*$`)

type snapshot struct {
	SchemaVersion int               `json:"schemaVersion"`
	Module        string            `json:"module"`
	Version       string            `json:"version"`
	Symbols       map[string]string `json:"symbols"`
}

type semanticVersion struct {
	major int
	minor int
	patch int
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "Framework API compatibility:", err)
		os.Exit(1)
	}
}

func run() error {
	root := flag.String("root", "Framework", "Framework module root")
	baselinePath := flag.String("baseline", "Framework/api-snapshot.json", "working API snapshot")
	baselineRef := flag.String("baseline-ref", "", "optional Git ref containing the comparison snapshot")
	write := flag.Bool("write", false, "replace the working snapshot with the current API")
	flag.Parse()
	if flag.NArg() != 0 {
		return fmt.Errorf("unexpected arguments: %s", strings.Join(flag.Args(), " "))
	}
	if *write && *baselineRef != "" {
		return errors.New("-write and -baseline-ref cannot be used together")
	}

	current, err := collectSnapshot(*root)
	if err != nil {
		return err
	}
	if *write {
		if err := writeSnapshot(*baselinePath, current); err != nil {
			return err
		}
		fmt.Printf("Framework API snapshot written to %s (%d symbols)\n", *baselinePath, len(current.Symbols))
		return nil
	}

	working, err := readSnapshotFile(*baselinePath)
	if err != nil {
		return err
	}
	if changes := exactChanges(working, current); len(changes) > 0 {
		return fmt.Errorf("working snapshot is stale; run yarn api:snapshot:\n%s", strings.Join(changes, "\n"))
	}

	if *baselineRef != "" {
		base, err := readSnapshotFromGit(*baselineRef, *baselinePath)
		if err != nil {
			return err
		}
		if compareSemanticVersions(current.Version, base.Version) < 0 {
			return fmt.Errorf("Framework version regressed from %s to %s", base.Version, current.Version)
		}
		changes := compatibilityChanges(base, current)
		if len(changes) > 0 && !allowsBreakingChange(base.Version, current.Version) {
			return fmt.Errorf(
				"public API is incompatible with %s at version %s; bump the SemVer compatibility line and document the migration:\n%s",
				*baselineRef,
				current.Version,
				strings.Join(changes, "\n"),
			)
		}
		if len(changes) > 0 {
			changed, err := fileDiffersFromGit(*baselineRef, filepath.Join(*root, "CHANGELOG.md"))
			if err != nil {
				return err
			}
			if !changed {
				return errors.New("breaking API change requires an updated Framework/CHANGELOG.md")
			}
			fmt.Printf("Framework API breaking changes accepted by version transition %s -> %s\n", base.Version, current.Version)
		}
	}

	fmt.Printf("Framework API compatibility passed (%s, %d symbols)\n", current.Version, len(current.Symbols))
	return nil
}

func collectSnapshot(root string) (snapshot, error) {
	moduleBytes, err := os.ReadFile(filepath.Join(root, "go.mod"))
	if err != nil {
		return snapshot{}, fmt.Errorf("read module: %w", err)
	}
	moduleMatch := modulePattern.FindSubmatch(moduleBytes)
	if len(moduleMatch) != 2 {
		return snapshot{}, errors.New("Framework/go.mod must declare a module path")
	}
	versionBytes, err := os.ReadFile(filepath.Join(root, "VERSION"))
	if err != nil {
		return snapshot{}, fmt.Errorf("read Framework version: %w", err)
	}
	version := strings.TrimSpace(string(versionBytes))
	if _, err := parseSemanticVersion(version); err != nil {
		return snapshot{}, fmt.Errorf("invalid Framework/VERSION: %w", err)
	}

	filesByDirectory := make(map[string][]string)
	err = filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if path != root && excludedDirectory(entry.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasSuffix(entry.Name(), ".go") && !strings.HasSuffix(entry.Name(), "_test.go") {
			filesByDirectory[filepath.Dir(path)] = append(filesByDirectory[filepath.Dir(path)], path)
		}
		return nil
	})
	if err != nil {
		return snapshot{}, fmt.Errorf("walk Framework packages: %w", err)
	}

	result := snapshot{
		SchemaVersion: snapshotSchemaVersion,
		Module:        string(moduleMatch[1]),
		Version:       version,
		Symbols:       make(map[string]string),
	}
	directories := make([]string, 0, len(filesByDirectory))
	for directory := range filesByDirectory {
		directories = append(directories, directory)
	}
	sort.Strings(directories)
	for _, directory := range directories {
		if err := collectPackageSymbols(root, directory, filesByDirectory[directory], &result); err != nil {
			return snapshot{}, err
		}
	}
	return result, nil
}

func excludedDirectory(name string) bool {
	return name == "internal" || name == "testdata" || name == "vendor" || strings.HasPrefix(name, ".")
}

func collectPackageSymbols(root, directory string, files []string, target *snapshot) error {
	fset := token.NewFileSet()
	sort.Strings(files)
	var packageName string
	var declarations []ast.Decl
	for _, filePath := range files {
		file, err := parser.ParseFile(fset, filePath, nil, parser.SkipObjectResolution)
		if err != nil {
			return fmt.Errorf("parse %s: %w", filePath, err)
		}
		if packageName == "" {
			packageName = file.Name.Name
		} else if packageName != file.Name.Name {
			return fmt.Errorf("directory %s contains multiple production packages", directory)
		}
		declarations = append(declarations, file.Decls...)
	}
	if packageName == "main" {
		return nil
	}
	relative, err := filepath.Rel(root, directory)
	if err != nil {
		return fmt.Errorf("resolve package path: %w", err)
	}
	packagePath := target.Module
	if relative != "." {
		packagePath += "/" + filepath.ToSlash(relative)
	}
	for _, declaration := range declarations {
		if err := collectDeclaration(fset, packagePath, declaration, target.Symbols); err != nil {
			return err
		}
	}
	return nil
}

func collectDeclaration(fset *token.FileSet, packagePath string, declaration ast.Decl, symbols map[string]string) error {
	switch value := declaration.(type) {
	case *ast.FuncDecl:
		if !value.Name.IsExported() {
			return nil
		}
		kind := "func " + value.Name.Name
		if value.Recv != nil {
			receiver, exported := exportedReceiver(fset, value.Recv)
			if !exported {
				return nil
			}
			kind = "method " + receiver + "." + value.Name.Name
		}
		copy := *value
		copy.Body = nil
		copy.Doc = nil
		return addSymbol(symbols, packagePath+"::"+kind, renderNode(fset, &copy))
	case *ast.GenDecl:
		for _, rawSpec := range value.Specs {
			switch spec := rawSpec.(type) {
			case *ast.TypeSpec:
				if spec.Name.IsExported() {
					publicSpec := publicTypeSpec(spec)
					if err := addSymbol(symbols, packagePath+"::type "+spec.Name.Name, value.Tok.String()+" "+renderNode(fset, publicSpec)); err != nil {
						return err
					}
				}
			case *ast.ValueSpec:
				for index, name := range spec.Names {
					if !name.IsExported() {
						continue
					}
					copy := valueSpecForName(spec, index)
					if err := addSymbol(symbols, packagePath+"::"+value.Tok.String()+" "+name.Name, value.Tok.String()+" "+renderNode(fset, copy)); err != nil {
						return err
					}
				}
			}
		}
	}
	return nil
}

func publicTypeSpec(spec *ast.TypeSpec) *ast.TypeSpec {
	result := *spec
	result.Doc = nil
	result.Comment = nil
	structure, ok := spec.Type.(*ast.StructType)
	if !ok {
		return &result
	}
	structureCopy := *structure
	fieldsCopy := *structure.Fields
	fieldsCopy.List = make([]*ast.Field, 0, len(structure.Fields.List))
	for _, field := range structure.Fields.List {
		if len(field.Names) == 0 {
			if exportedEmbeddedType(field.Type) {
				fieldCopy := *field
				fieldCopy.Doc = nil
				fieldCopy.Comment = nil
				fieldsCopy.List = append(fieldsCopy.List, &fieldCopy)
			}
			continue
		}
		exportedNames := make([]*ast.Ident, 0, len(field.Names))
		for _, name := range field.Names {
			if name.IsExported() {
				exportedNames = append(exportedNames, name)
			}
		}
		if len(exportedNames) == 0 {
			continue
		}
		fieldCopy := *field
		fieldCopy.Doc = nil
		fieldCopy.Comment = nil
		fieldCopy.Names = append([]*ast.Ident(nil), exportedNames...)
		fieldsCopy.List = append(fieldsCopy.List, &fieldCopy)
	}
	structureCopy.Fields = &fieldsCopy
	result.Type = &structureCopy
	return &result
}

func exportedEmbeddedType(expression ast.Expr) bool {
	for {
		switch value := expression.(type) {
		case *ast.StarExpr:
			expression = value.X
		case *ast.IndexExpr:
			expression = value.X
		case *ast.IndexListExpr:
			expression = value.X
		case *ast.SelectorExpr:
			return value.Sel.IsExported()
		case *ast.Ident:
			return value.IsExported()
		default:
			return false
		}
	}
}

func exportedReceiver(fset *token.FileSet, receiver *ast.FieldList) (string, bool) {
	if receiver == nil || len(receiver.List) != 1 {
		return "", false
	}
	base := receiver.List[0].Type
	for {
		switch value := base.(type) {
		case *ast.StarExpr:
			base = value.X
		case *ast.IndexExpr:
			base = value.X
		case *ast.IndexListExpr:
			base = value.X
		default:
			identifier, ok := base.(*ast.Ident)
			return renderNode(fset, receiver.List[0].Type), ok && identifier.IsExported()
		}
	}
}

func valueSpecForName(spec *ast.ValueSpec, index int) *ast.ValueSpec {
	copy := *spec
	copy.Doc = nil
	copy.Comment = nil
	copy.Names = []*ast.Ident{spec.Names[index]}
	if len(spec.Values) == len(spec.Names) {
		copy.Values = []ast.Expr{spec.Values[index]}
	} else if len(spec.Names) > 1 {
		copy.Values = nil
	}
	return &copy
}

func renderNode(fset *token.FileSet, node any) string {
	var output bytes.Buffer
	if err := format.Node(&output, fset, node); err != nil {
		panic(err)
	}
	return output.String()
}

func addSymbol(symbols map[string]string, key, signature string) error {
	if previous, exists := symbols[key]; exists {
		return fmt.Errorf("duplicate exported symbol %s (%q and %q)", key, previous, signature)
	}
	symbols[key] = signature
	return nil
}

func writeSnapshot(path string, value snapshot) error {
	encoded, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return fmt.Errorf("encode snapshot: %w", err)
	}
	if err := os.WriteFile(path, append(encoded, '\n'), 0o644); err != nil {
		return fmt.Errorf("write snapshot: %w", err)
	}
	return nil
}

func readSnapshotFile(path string) (snapshot, error) {
	contents, err := os.ReadFile(path)
	if err != nil {
		return snapshot{}, fmt.Errorf("read snapshot %s: %w", path, err)
	}
	return decodeSnapshot(contents, path)
}

func readSnapshotFromGit(ref, path string) (snapshot, error) {
	if !validGitRef(ref) {
		return snapshot{}, fmt.Errorf("invalid baseline Git ref %q", ref)
	}
	cleanPath := filepath.ToSlash(filepath.Clean(path))
	if filepath.IsAbs(path) || cleanPath == ".." || strings.HasPrefix(cleanPath, "../") {
		return snapshot{}, errors.New("baseline snapshot path must remain inside the repository")
	}
	command := exec.Command("git", "show", ref+":"+cleanPath)
	contents, err := command.Output()
	if err != nil {
		return snapshot{}, fmt.Errorf("read %s:%s: %w", ref, cleanPath, err)
	}
	return decodeSnapshot(contents, ref+":"+cleanPath)
}

func fileDiffersFromGit(ref, path string) (bool, error) {
	if !validGitRef(ref) {
		return false, fmt.Errorf("invalid baseline Git ref %q", ref)
	}
	cleanPath := filepath.ToSlash(filepath.Clean(path))
	if filepath.IsAbs(path) || cleanPath == ".." || strings.HasPrefix(cleanPath, "../") {
		return false, errors.New("comparison path must remain inside the repository")
	}
	base, err := exec.Command("git", "show", ref+":"+cleanPath).Output()
	if err != nil {
		return false, fmt.Errorf("read %s:%s: %w", ref, cleanPath, err)
	}
	current, err := os.ReadFile(path)
	if err != nil {
		return false, fmt.Errorf("read %s: %w", path, err)
	}
	return !bytes.Equal(base, current), nil
}

func validGitRef(ref string) bool {
	if ref == "" || strings.HasPrefix(ref, "-") || strings.Contains(ref, "..") || strings.Contains(ref, "@{") {
		return false
	}
	for _, character := range ref {
		if !(character >= 'a' && character <= 'z') && !(character >= 'A' && character <= 'Z') &&
			!(character >= '0' && character <= '9') && !strings.ContainsRune("._/-", character) {
			return false
		}
	}
	return true
}

func decodeSnapshot(contents []byte, source string) (snapshot, error) {
	var result snapshot
	decoder := json.NewDecoder(bytes.NewReader(contents))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&result); err != nil {
		return snapshot{}, fmt.Errorf("decode snapshot %s: %w", source, err)
	}
	if result.SchemaVersion != snapshotSchemaVersion || result.Module == "" || result.Symbols == nil {
		return snapshot{}, fmt.Errorf("snapshot %s has an unsupported schema", source)
	}
	if _, err := parseSemanticVersion(result.Version); err != nil {
		return snapshot{}, fmt.Errorf("snapshot %s has invalid version: %w", source, err)
	}
	return result, nil
}

func exactChanges(expected, current snapshot) []string {
	changes := make([]string, 0)
	if expected.Module != current.Module {
		changes = append(changes, fmt.Sprintf("module changed: %s -> %s", expected.Module, current.Module))
	}
	if expected.Version != current.Version {
		changes = append(changes, fmt.Sprintf("version changed: %s -> %s", expected.Version, current.Version))
	}
	for key, signature := range expected.Symbols {
		currentSignature, exists := current.Symbols[key]
		if !exists {
			changes = append(changes, "removed: "+key)
		} else if currentSignature != signature {
			changes = append(changes, "changed: "+key)
		}
	}
	for key := range current.Symbols {
		if _, exists := expected.Symbols[key]; !exists {
			changes = append(changes, "added: "+key)
		}
	}
	sort.Strings(changes)
	return changes
}

func compatibilityChanges(base, current snapshot) []string {
	changes := make([]string, 0)
	if base.Module != current.Module {
		changes = append(changes, fmt.Sprintf("module changed: %s -> %s", base.Module, current.Module))
	}
	for key, signature := range base.Symbols {
		currentSignature, exists := current.Symbols[key]
		if !exists {
			changes = append(changes, "removed: "+key)
		} else if currentSignature != signature {
			changes = append(changes, "changed: "+key)
		}
	}
	sort.Strings(changes)
	return changes
}

func allowsBreakingChange(baseVersion, currentVersion string) bool {
	base, baseErr := parseSemanticVersion(baseVersion)
	current, currentErr := parseSemanticVersion(currentVersion)
	if baseErr != nil || currentErr != nil {
		return false
	}
	if current.major > base.major {
		return true
	}
	return base.major == 0 && current.major == 0 && current.minor > base.minor
}

func compareSemanticVersions(leftValue, rightValue string) int {
	left, leftErr := parseSemanticVersion(leftValue)
	right, rightErr := parseSemanticVersion(rightValue)
	if leftErr != nil || rightErr != nil {
		return 0
	}
	leftParts := [...]int{left.major, left.minor, left.patch}
	rightParts := [...]int{right.major, right.minor, right.patch}
	for index := range leftParts {
		if leftParts[index] < rightParts[index] {
			return -1
		}
		if leftParts[index] > rightParts[index] {
			return 1
		}
	}
	return 0
}

func parseSemanticVersion(value string) (semanticVersion, error) {
	parts := strings.Split(value, ".")
	if len(parts) != 3 {
		return semanticVersion{}, errors.New("version must use major.minor.patch")
	}
	numbers := make([]int, 3)
	for index, part := range parts {
		if part == "" || (len(part) > 1 && part[0] == '0') {
			return semanticVersion{}, errors.New("version components must be canonical non-negative integers")
		}
		number, err := strconv.Atoi(part)
		if err != nil || number < 0 {
			return semanticVersion{}, errors.New("version components must be canonical non-negative integers")
		}
		numbers[index] = number
	}
	return semanticVersion{major: numbers[0], minor: numbers[1], patch: numbers[2]}, nil
}
