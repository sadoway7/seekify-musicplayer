FROM golang:1.23-alpine AS build
WORKDIR /build
COPY go.mod server.go ./
RUN go build -o server server.go

FROM alpine:latest
WORKDIR /app
COPY --from=build /build/server .
COPY index.html .
COPY css/ css/
COPY js/ js/
COPY icon.png .
RUN mkdir -p db/backups
EXPOSE 8081
CMD ["./server"]
