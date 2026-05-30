FROM golang:1.26-alpine AS build
WORKDIR /build
COPY go.mod go.sum ./
COPY vendor/ vendor/
COPY *.go ./
RUN go build -mod=vendor -o server .

FROM alpine:latest
WORKDIR /app
COPY --from=build /build/server .
COPY index.html .
COPY css/ css/
COPY js/ js/
COPY icon.png .
RUN mkdir -p /app/data
EXPOSE 8081
CMD ["./server"]
