package grpcparse

import (
	"bytes"
	"regexp"
	"strconv"
	"strings"
)

// Message is a best-effort decode of plaintext gRPC/HTTP2 fragments.
// Full HPACK is not implemented — we scrape ASCII literals common in never-indexed headers.
type Message struct {
	Method string // /package.Service/Method
	Status *int   // grpc-status code when present
	IsH2   bool
}

var (
	methodRe = regexp.MustCompile(`/[A-Za-z][A-Za-z0-9_.]*(?:\.[A-Za-z][A-Za-z0-9_.]*)+/[A-Za-z][A-Za-z0-9_]*`)
	statusRe = regexp.MustCompile(`grpc-status[\x00-\x20:=]+([0-9]{1,2})`)
)

// Parse extracts gRPC method / status from a captured payload fragment.
func Parse(payload []byte) (Message, bool) {
	if len(payload) < 9 {
		return Message{}, false
	}

	msg := Message{}
	if bytes.HasPrefix(payload, []byte("PRI * HTTP/2.0")) {
		msg.IsH2 = true
	}
	if len(payload) >= 9 && payload[3] == 0x01 {
		msg.IsH2 = true
	}

	lower := strings.ToLower(string(payload))
	hasGrpc := strings.Contains(lower, "application/grpc") ||
		strings.Contains(lower, "grpc-status") ||
		strings.Contains(lower, "grpc-message")

	if m := methodRe.Find(payload); len(m) > 0 {
		msg.Method = string(m)
	}
	if sm := statusRe.FindSubmatch(payload); len(sm) == 2 {
		if code, err := strconv.Atoi(string(sm[1])); err == nil && code >= 0 && code <= 16 {
			msg.Status = &code
		}
	}

	if msg.Method == "" && msg.Status == nil && !hasGrpc && !msg.IsH2 {
		return Message{}, false
	}
	// HTTP/2 HEADERS without grpc markers — keep only if we found a method-like path.
	if msg.Method == "" && msg.Status == nil && !hasGrpc {
		return Message{}, false
	}
	return msg, true
}

// StatusName maps a gRPC status code to its canonical name.
func StatusName(code int) string {
	switch code {
	case 0:
		return "OK"
	case 1:
		return "CANCELLED"
	case 2:
		return "UNKNOWN"
	case 3:
		return "INVALID_ARGUMENT"
	case 4:
		return "DEADLINE_EXCEEDED"
	case 5:
		return "NOT_FOUND"
	case 6:
		return "ALREADY_EXISTS"
	case 7:
		return "PERMISSION_DENIED"
	case 8:
		return "RESOURCE_EXHAUSTED"
	case 9:
		return "FAILED_PRECONDITION"
	case 10:
		return "ABORTED"
	case 11:
		return "OUT_OF_RANGE"
	case 12:
		return "UNIMPLEMENTED"
	case 13:
		return "INTERNAL"
	case 14:
		return "UNAVAILABLE"
	case 15:
		return "DATA_LOSS"
	case 16:
		return "UNAUTHENTICATED"
	default:
		return "UNKNOWN"
	}
}
