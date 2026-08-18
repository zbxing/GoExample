FROM golang:1.26.6-alpine@sha256:3889b425f035be855a72fb4755265311293b6d414521f0a519d819df32222d83 AS builder

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
