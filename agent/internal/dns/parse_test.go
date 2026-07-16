package dns

import (
	"encoding/binary"
	"testing"
)

func TestParseQueryA(t *testing.T) {
	// Transaction 0x1234, query, 1 question: example.com A IN
	payload := []byte{
		0x12, 0x34, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
		0x07, 'e', 'x', 'a', 'm', 'p', 'l', 'e',
		0x03, 'c', 'o', 'm',
		0x00,
		0x00, 0x01,
		0x00, 0x01,
	}
	msg, ok := Parse(payload)
	if !ok {
		t.Fatal("expected parse ok")
	}
	if msg.Txid != 0x1234 {
		t.Fatalf("txid=%d", msg.Txid)
	}
	if msg.QR {
		t.Fatal("expected query")
	}
	if msg.Query != "example.com" {
		t.Fatalf("query=%q", msg.Query)
	}
	if msg.QTypeName != "A" {
		t.Fatalf("type=%q", msg.QTypeName)
	}
}

func TestParseNXDOMAIN(t *testing.T) {
	payload := []byte{
		0x00, 0x01, 0x81, 0x83, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
		0x07, 'm', 'i', 's', 's', 'i', 'n', 'g',
		0x03, 't', 'l', 'd',
		0x00,
		0x00, 0x01,
		0x00, 0x01,
	}
	msg, ok := Parse(payload)
	if !ok {
		t.Fatal("expected parse ok")
	}
	if !msg.QR {
		t.Fatal("expected response")
	}
	if msg.RcodeName != "NXDOMAIN" {
		t.Fatalf("rcode=%q", msg.RcodeName)
	}
	if msg.Query != "missing.tld" {
		t.Fatalf("query=%q", msg.Query)
	}
}

func TestParseAnswerA(t *testing.T) {
	// response with one A answer for example.com -> 93.184.216.34
	qname := []byte{0x07, 'e', 'x', 'a', 'm', 'p', 'l', 'e', 0x03, 'c', 'o', 'm', 0x00}
	payload := make([]byte, 0, 64)
	payload = append(payload, 0x00, 0x02, 0x81, 0x80, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00)
	payload = append(payload, qname...)
	payload = append(payload, 0x00, 0x01, 0x00, 0x01) // question A IN
	// answer: pointer to name at offset 12, A IN TTL rdlen 4
	payload = append(payload, 0xc0, 0x0c)
	payload = append(payload, 0x00, 0x01, 0x00, 0x01)
	payload = append(payload, 0x00, 0x00, 0x00, 0x3c)
	payload = append(payload, 0x00, 0x04)
	payload = append(payload, 93, 184, 216, 34)

	msg, ok := Parse(payload)
	if !ok {
		t.Fatal("expected parse ok")
	}
	if msg.RcodeName != "NOERROR" {
		t.Fatalf("rcode=%q", msg.RcodeName)
	}
	if len(msg.Answers) != 1 || msg.Answers[0] != "A 93.184.216.34" {
		t.Fatalf("answers=%v", msg.Answers)
	}
	_ = binary.BigEndian
}
