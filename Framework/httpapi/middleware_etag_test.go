package httpapi

import (
	"bytes"
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
