package projectapi

import (
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestProductionProjectCompositionDoesNotImportFiber(t *testing.T) {
	for _, directory := range []string{".", filepath.Join("..", "..", "cmd", "server")} {
		entries, err := os.ReadDir(directory)
		if err != nil {
			t.Fatalf("read %s: %v", directory, err)
		}
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".go") || strings.HasSuffix(entry.Name(), "_test.go") {
				continue
			}
			filePath := filepath.Join(directory, entry.Name())
			file, err := parser.ParseFile(token.NewFileSet(), filePath, nil, 0)
			if err != nil {
				t.Fatalf("parse %s: %v", filePath, err)
			}
			for _, imported := range file.Imports {
				importPath, err := strconv.Unquote(imported.Path.Value)
				if err != nil {
					t.Fatalf("unquote import in %s: %v", filePath, err)
				}
				if strings.Contains(importPath, "github.com/gofiber/") {
					t.Fatalf("production composition imports Fiber dependency %q in %s", importPath, filePath)
				}
			}
		}
	}
}
