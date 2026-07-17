FROM golang:1.26-alpine AS build
WORKDIR /build
COPY go.mod go.sum ./
COPY vendor/ vendor/
COPY *.go ./
COPY internal/ internal/
COPY extension/ extension/
RUN go build -mod=vendor -o server .

FROM alpine:latest
RUN apk add --no-cache python3 py3-pip ffmpeg \
    && pip install --no-cache-dir --break-system-packages --upgrade yt-dlp mutagen musicbrainzngs lyriq requests aioslsk
WORKDIR /app
COPY --from=build /build/server .
COPY index.html .
COPY assets/ assets/
COPY css/ css/
COPY js/ js/
COPY scripts/ scripts/
COPY apple-touch-icon.png icon.png icon-192.png favicon-32.png favicon-16.png manifest.webmanifest .
RUN mkdir -p /app/data
EXPOSE 8081
CMD ["./server"]
