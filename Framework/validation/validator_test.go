package validation

import (
	"strings"
	"testing"
)

func TestValidateAndMessage(t *testing.T) {
	input := struct {
		Email string `json:"email" validate:"required,email"`
	}{Email: "invalid"}

	err := New().Validate(input)
	if err == nil {
		t.Fatal("Validate() error = nil")
	}
	if message := Message(err); !strings.Contains(message, "email") {
		t.Fatalf("Message() = %q", message)
	}
}
