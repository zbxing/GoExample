FROM golang:1.25.13-alpine@sha256:1e0126852075c9c60731c8ba49088448b91f63e2aed97ca9d1a9791622a05946 AS builder

ARG VERSION=dev
ARG COMMIT=unknown
ARG BUILD_TIME=unknown

WORKDIR /src
COPY Framework/go.mod Framework/go.sum ./Framework/
COPY Proj/Example/go.mod Proj/Example/go.sum ./Proj/Example/
RUN GOWORK=off go -C Framework mod download
RUN GOWORK=off go -C Proj/Example mod download
COPY Framework ./Framework
COPY Proj/Example ./Proj/Example
RUN CGO_ENABLED=0 GOWORK=off go -C Proj/Example build -trimpath \
    -ldflags="-s -w -X main.version=${VERSION} -X main.commit=${COMMIT} -X main.buildTime=${BUILD_TIME}" \
    -o /out/server ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot@sha256:1b7b9f0f0e0a1d2155f531db587cc48ec26aaf97ab64364225f5bf18a054e66a
COPY --from=builder /out/server /server
EXPOSE 3001
ENTRYPOINT ["/server"]
