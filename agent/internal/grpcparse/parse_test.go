package grpcparse

import "testing"

func TestParseMethodLiteral(t *testing.T) {
	payload := []byte("\x00\x00\x1a\x01\x04\x00\x00\x00\x01" +
		"content-typeapplication/grpc" +
		"/helloworld.Greeter/SayHello")
	msg, ok := Parse(payload)
	if !ok {
		t.Fatal("expected parse ok")
	}
	if msg.Method != "/helloworld.Greeter/SayHello" {
		t.Fatalf("method=%q", msg.Method)
	}
}

func TestParseGrpcStatus(t *testing.T) {
	payload := []byte("application/grpc\x00grpc-status: 14\x00")
	msg, ok := Parse(payload)
	if !ok || msg.Status == nil || *msg.Status != 14 {
		t.Fatalf("got %+v ok=%v", msg, ok)
	}
}

func TestParseRejectsNoise(t *testing.T) {
	if _, ok := Parse([]byte("GET /index.html HTTP/1.1\r\n")); ok {
		t.Fatal("http should not parse as grpc")
	}
}

func TestStatusName(t *testing.T) {
	if StatusName(0) != "OK" || StatusName(14) != "UNAVAILABLE" {
		t.Fatal("status names")
	}
}
