package httpapi

import (
	"bytes"
	"strings"
	"testing"

	fiberetag "github.com/gofiber/fiber/v3/middleware/etag"
)

var weakETagResult byte

func TestGenerateWeakETagMatchesFiberWithoutAllocations(t *testing.T) {
	for _, body := range [][]byte{
		nil,
		[]byte("hello"),
		bytes.Repeat([]byte{0xab}, 4096),
	} {
		var storage [maxWeakETagLength]byte
		got := generateWeakETag(body, &storage)
		want := fiberetag.GenerateWeak(body)
		if !bytes.Equal(got, want) {
			t.Fatalf("generateWeakETag(%d bytes) = %q, want %q", len(body), got, want)
		}
	}

	body := []byte("allocation gate")
	allocations := testing.AllocsPerRun(1000, func() {
		var storage [maxWeakETagLength]byte
		tag := generateWeakETag(body, &storage)
		weakETagResult = tag[len(tag)-1]
	})
	if allocations != 0 {
		t.Fatalf("generateWeakETag allocations = %.1f, want 0", allocations)
	}
}

func TestWeakETagMatchesFastPathAndListSemantics(t *testing.T) {
	const expected = `W/"7-1234"`
	for _, test := range []struct {
		name   string
		header string
		want   bool
	}{
		{name: "exact weak", header: expected, want: true},
		{name: "strong equivalent", header: `"7-1234"`, want: true},
		{name: "wildcard", header: "*", want: true},
		{name: "list", header: `"other", W/"7-1234"`, want: true},
		{name: "different", header: `W/"7-1235"`, want: false},
		{name: "double weak prefix", header: `W/W/"7-1234"`, want: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := weakETagMatches(test.header, expected); got != test.want {
				t.Fatalf("weakETagMatches(%q, %q) = %v, want %v", test.header, expected, got, test.want)
			}
		})
	}
}

func BenchmarkWeakETagMatchesExact(b *testing.B) {
	const expected = `W/"7-1234"`
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if weakETagMatches(expected, expected) {
			weakETagResult++
		}
	}
}

func BenchmarkWeakETagMatchesStrongEquivalent(b *testing.B) {
	const expected = `W/"7-1234"`
	const header = `"7-1234"`
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if weakETagMatches(header, expected) {
			weakETagResult++
		}
	}
}

func BenchmarkWeakETagMatchesStrongEquivalentLegacy(b *testing.B) {
	const expected = `W/"7-1234"`
	const header = `"7-1234"`
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if legacyWeakETagMatches(header, expected) {
			weakETagResult++
		}
	}
}

// legacyWeakETagMatches is a benchmark-only control for the pre-fast-path loop.
func legacyWeakETagMatches(header, expected string) bool {
	expected = strings.TrimPrefix(expected, "W/")
	for value := range strings.SplitSeq(header, ",") {
		value = strings.TrimSpace(value)
		if value == "*" || strings.TrimPrefix(value, "W/") == expected {
			return true
		}
	}
	return false
}
