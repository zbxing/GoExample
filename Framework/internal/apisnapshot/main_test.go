package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCollectSnapshotKeepsOnlyImportableExportedAPI(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, root, "go.mod", "module example.test/framework\n")
	writeTestFile(t, root, "VERSION", "0.1.0\n")
	writeTestFile(t, root, "public/api.go", `package public
const Exported = 1
const hidden = 2
type Service struct { Name string; private string }
func New() *Service { return &Service{} }
func (s *Service) Run(value string) error { return nil }
func hiddenFunction() {}
`)
	writeTestFile(t, root, "public/api_test.go", "package public\nfunc TestOnly() {}\n")
	writeTestFile(t, root, "internal/secret/api.go", "package secret\nfunc Leaked() {}\n")

	result, err := collectSnapshot(root)
	if err != nil {
		t.Fatalf("collectSnapshot() error = %v", err)
	}
	want := []string{
		"example.test/framework/public::const Exported",
		"example.test/framework/public::func New",
		"example.test/framework/public::method *Service.Run",
		"example.test/framework/public::type Service",
	}
	if len(result.Symbols) != len(want) {
		t.Fatalf("symbols = %#v", result.Symbols)
	}
	for _, key := range want {
		if _, exists := result.Symbols[key]; !exists {
			t.Errorf("missing symbol %q in %#v", key, result.Symbols)
		}
	}
	if signature := result.Symbols["example.test/framework/public::type Service"]; signature != "type Service struct{ Name string }" {
		t.Fatalf("public Service signature = %q", signature)
	}
}

func TestSnapshotComparisonAllowsAdditionsAndGuardsBreakingChanges(t *testing.T) {
	base := snapshot{
		SchemaVersion: 1,
		Module:        "example.test/framework",
		Version:       "0.1.0",
		Symbols:       map[string]string{"package::func Existing": "func Existing()"},
	}
	additive := snapshot{
		SchemaVersion: 1,
		Module:        base.Module,
		Version:       base.Version,
		Symbols: map[string]string{
			"package::func Existing": "func Existing()",
			"package::func New":      "func New()",
		},
	}
	if changes := compatibilityChanges(base, additive); len(changes) != 0 {
		t.Fatalf("additive compatibility changes = %v", changes)
	}
	if changes := exactChanges(base, additive); len(changes) != 1 || changes[0] != "added: package::func New" {
		t.Fatalf("additive exact changes = %v", changes)
	}

	breaking := additive
	breaking.Symbols = map[string]string{"package::func Existing": "func Existing(string)"}
	if changes := compatibilityChanges(base, breaking); len(changes) != 1 || changes[0] != "changed: package::func Existing" {
		t.Fatalf("breaking changes = %v", changes)
	}
	if allowsBreakingChange("0.1.0", "0.1.1") {
		t.Fatal("patch version allowed a breaking change")
	}
	if !allowsBreakingChange("0.1.0", "0.2.0") {
		t.Fatal("pre-1.0 minor version did not allow a breaking change")
	}
	if allowsBreakingChange("1.2.0", "1.3.0") {
		t.Fatal("stable minor version allowed a breaking change")
	}
	if !allowsBreakingChange("1.2.0", "2.0.0") {
		t.Fatal("stable major version did not allow a breaking change")
	}
	if compareSemanticVersions("0.1.9", "0.2.0") >= 0 || compareSemanticVersions("2.0.0", "1.9.9") <= 0 {
		t.Fatal("semantic version ordering is incorrect")
	}
}

func TestValidGitRefRejectsOptionAndRevisionSyntax(t *testing.T) {
	for _, ref := range []string{"HEAD", "main", "feature/api", "0123456789abcdef"} {
		if !validGitRef(ref) {
			t.Errorf("validGitRef(%q) = false", ref)
		}
	}
	for _, ref := range []string{"", "--help", "HEAD..main", "HEAD@{1}", "main:other", "main branch"} {
		if validGitRef(ref) {
			t.Errorf("validGitRef(%q) = true", ref)
		}
	}
}

func writeTestFile(t *testing.T, root, relative, contents string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(relative))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", path, err)
	}
	if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}
