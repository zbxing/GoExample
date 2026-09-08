FROM golang:1.27.1-alpine@sha256:cf6fca6641884b8433441b2b0652976f975e1d0fdd26d177eaaf8596087f3125 AS builder

ARG VERSION=dev
ARG COMMIT=unknown
ARG BUILD_TIME=unknown

WORKDIR /src
COPY Framework/go.mod Framework/go.sum ./Framework/
COPY Solutions/Example/go.mod Solutions/Example/go.sum ./Solutions/Example/
RUN GOWORK=off go -C Framework mod download
RUN GOWORK=off go -C Solutions/Example mod download
COPY Framework ./Framework
COPY Solutions/Example ./Solutions/Example
RUN CGO_ENABLED=0 GOWORK=off go -C Solutions/Example build -trimpath \
    -ldflags="-s -w -X main.version=${VERSION} -X main.commit=${COMMIT} -X main.buildTime=${BUILD_TIME}" \
    -o /out/server ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot@sha256:1b7b9f0f0e0a1d2155f531db587cc48ec26aaf97ab64364225f5bf18a054e66a
COPY --from=builder /out/server /server
EXPOSE 3001
ENTRYPOINT ["/server"]
