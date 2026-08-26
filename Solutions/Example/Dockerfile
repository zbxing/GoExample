FROM golang:1.27.0-alpine@sha256:4c9fe60190a2a3350ddc51de80d0224b8a6698d12bdfc999fee45ea9d6c46dbc AS builder

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
