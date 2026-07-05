FROM golang:1.23-alpine AS build
WORKDIR /src

ENV GOPROXY=https://proxy.golang.org,direct

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /kern-agent .

FROM gcr.io/distroless/static-debian12
USER 0:0
COPY --from=build /kern-agent /kern-agent
EXPOSE 9474
ENTRYPOINT ["/kern-agent"]
