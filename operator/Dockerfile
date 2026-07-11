# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG TARGETARCH=amd64
RUN CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} go build -ldflags="-s -w" -o /kern-operator .

FROM gcr.io/distroless/static-debian12
COPY --from=build /kern-operator /kern-operator
USER 65532:65532
ENTRYPOINT ["/kern-operator"]
