package httpparse

import (
	"bytes"
	"strconv"
	"strings"
)

// Message is a decoded plaintext HTTP/1.x request or response prefix.
type Message struct {
	IsResponse bool
	Method     string
	Path       string
	Status     int
	StatusText string
}

// Parse decodes the start-line of an HTTP/1.x message from wire bytes.
func Parse(payload []byte) (Message, bool) {
	if len(payload) < 8 {
		return Message{}, false
	}

	end := bytes.Index(payload, []byte("\r\n"))
	if end < 0 {
		end = bytes.IndexByte(payload, '\n')
	}
	if end < 0 {
		end = len(payload)
		if end > 256 {
			end = 256
		}
	}
	line := strings.TrimSpace(string(payload[:end]))
	if line == "" {
		return Message{}, false
	}

	if strings.HasPrefix(line, "HTTP/") {
		parts := strings.SplitN(line, " ", 3)
		if len(parts) < 2 {
			return Message{}, false
		}
		code, err := strconv.Atoi(parts[1])
		if err != nil || code < 100 || code > 599 {
			return Message{}, false
		}
		msg := Message{IsResponse: true, Status: code}
		if len(parts) == 3 {
			msg.StatusText = parts[2]
		}
		return msg, true
	}

	parts := strings.SplitN(line, " ", 3)
	if len(parts) < 2 {
		return Message{}, false
	}
	method := parts[0]
	switch method {
	case "GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS", "PATCH", "TRACE", "CONNECT":
	default:
		return Message{}, false
	}
	path := parts[1]
	if path == "" {
		path = "/"
	}
	return Message{Method: method, Path: path}, true
}
