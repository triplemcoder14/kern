package httpparse

import "testing"

func TestParseRequest(t *testing.T) {
	msg, ok := Parse([]byte("GET /api/v1/health HTTP/1.1\r\nHost: demo\r\n\r\n"))
	if !ok {
		t.Fatal("expected ok")
	}
	if msg.Method != "GET" || msg.Path != "/api/v1/health" || msg.IsResponse {
		t.Fatalf("%+v", msg)
	}
}

func TestParseResponse(t *testing.T) {
	msg, ok := Parse([]byte("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n"))
	if !ok {
		t.Fatal("expected ok")
	}
	if !msg.IsResponse || msg.Status != 404 || msg.StatusText != "Not Found" {
		t.Fatalf("%+v", msg)
	}
}

func TestParseRejectsTLS(t *testing.T) {
	if _, ok := Parse([]byte{0x16, 0x03, 0x01, 0x00, 0x05, 0x01, 0x00, 0x00}); ok {
		t.Fatal("tls handshake should not parse as http")
	}
}
