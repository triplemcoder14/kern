package dns

import (
	"encoding/binary"
	"fmt"
	"net"
	"strings"
)

// Message is a decoded DNS query or response.
type Message struct {
	Txid      uint16
	QR        bool // true = response
	Opcode    uint8
	Rcode     uint8
	RcodeName string
	Query     string
	QType     uint16
	QTypeName string
	Answers   []string
}

var rcodeNames = map[uint8]string{
	0: "NOERROR",
	1: "FORMERR",
	2: "SERVFAIL",
	3: "NXDOMAIN",
	4: "NOTIMP",
	5: "REFUSED",
}

var qtypeNames = map[uint16]string{
	1:  "A",
	2:  "NS",
	5:  "CNAME",
	6:  "SOA",
	12: "PTR",
	15: "MX",
	16: "TXT",
	28: "AAAA",
	33: "SRV",
	41: "OPT",
	255: "ANY",
}

// Parse decodes a DNS message from wire bytes (UDP payload).
func Parse(payload []byte) (Message, bool) {
	if len(payload) < 12 {
		return Message{}, false
	}

	txid := binary.BigEndian.Uint16(payload[0:2])
	flags := binary.BigEndian.Uint16(payload[2:4])
	qd := binary.BigEndian.Uint16(payload[4:6])
	an := binary.BigEndian.Uint16(payload[6:8])

	if qd == 0 || qd > 8 {
		return Message{}, false
	}

	msg := Message{
		Txid:   txid,
		QR:     flags&(1<<15) != 0,
		Opcode: uint8((flags >> 11) & 0xF),
		Rcode:  uint8(flags & 0xF),
	}
	msg.RcodeName = rcodeNames[msg.Rcode]
	if msg.RcodeName == "" {
		msg.RcodeName = fmt.Sprintf("RCODE%d", msg.Rcode)
	}

	off := 12
	name, next, ok := readName(payload, off)
	if !ok {
		return Message{}, false
	}
	off = next
	if off+4 > len(payload) {
		return Message{}, false
	}
	msg.Query = name
	msg.QType = binary.BigEndian.Uint16(payload[off : off+2])
	msg.QTypeName = qtypeNames[msg.QType]
	if msg.QTypeName == "" {
		msg.QTypeName = fmt.Sprintf("TYPE%d", msg.QType)
	}
	off += 4 // qtype + qclass

	if !msg.QR {
		return msg, true
	}

	limit := int(an)
	if limit > 8 {
		limit = 8
	}
	for i := 0; i < limit; i++ {
		answer, nextOff, aok := readAnswer(payload, off)
		if !aok {
			break
		}
		msg.Answers = append(msg.Answers, answer)
		off = nextOff
	}
	return msg, true
}

func readName(payload []byte, off int) (string, int, bool) {
	if off >= len(payload) {
		return "", off, false
	}
	var labels []string
	jumped := false
	start := off
	guard := 0
	for guard < 128 {
		guard++
		if off >= len(payload) {
			return "", start, false
		}
		length := int(payload[off])
		if length == 0 {
			off++
			break
		}
		// compression pointer
		if length&0xC0 == 0xC0 {
			if off+1 >= len(payload) {
				return "", start, false
			}
			ptr := int(binary.BigEndian.Uint16(payload[off:off+2]) & 0x3FFF)
			if !jumped {
				start = off + 2
			}
			off = ptr
			jumped = true
			continue
		}
		if length > 63 || off+1+length > len(payload) {
			return "", start, false
		}
		labels = append(labels, string(payload[off+1:off+1+length]))
		off += 1 + length
	}
	name := strings.Join(labels, ".")
	if name == "" {
		name = "."
	}
	if jumped {
		return name, start, true
	}
	return name, off, true
}

func readAnswer(payload []byte, off int) (string, int, bool) {
	_, next, ok := readName(payload, off)
	if !ok {
		return "", off, false
	}
	off = next
	if off+10 > len(payload) {
		return "", off, false
	}
	typ := binary.BigEndian.Uint16(payload[off : off+2])
	rdlength := int(binary.BigEndian.Uint16(payload[off+8 : off+10]))
	off += 10
	if rdlength < 0 || off+rdlength > len(payload) {
		return "", off, false
	}
	rdata := payload[off : off+rdlength]
	off += rdlength

	typeName := qtypeNames[typ]
	if typeName == "" {
		typeName = fmt.Sprintf("TYPE%d", typ)
	}

	switch typ {
	case 1: // A
		if len(rdata) == 4 {
			return fmt.Sprintf("A %s", net.IP(rdata).String()), off, true
		}
	case 28: // AAAA
		if len(rdata) == 16 {
			return fmt.Sprintf("AAAA %s", net.IP(rdata).String()), off, true
		}
	case 5: // CNAME
		name, _, nok := readName(payload, off-rdlength)
		if nok {
			return fmt.Sprintf("CNAME %s", name), off, true
		}
	case 16: // TXT
		if len(rdata) > 1 {
			n := int(rdata[0])
			if n > 0 && 1+n <= len(rdata) {
				return fmt.Sprintf("TXT %q", string(rdata[1:1+n])), off, true
			}
		}
	}
	return fmt.Sprintf("%s (%dB)", typeName, rdlength), off, true
}
