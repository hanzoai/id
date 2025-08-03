FROM --platform=$BUILDPLATFORM node:18.19.0 AS FRONT
WORKDIR /web
COPY ./web .
RUN yarn install --frozen-lockfile --network-timeout 1000000 && NODE_OPTIONS="--max-old-space-size=4096" yarn run build


FROM --platform=$BUILDPLATFORM golang:1.21.13 AS BACK
WORKDIR /go/src/hanzo-id
COPY . .
RUN ./build.sh
RUN go test -v -run TestGetVersionInfo ./util/system_test.go ./util/system.go > version_info.txt

FROM debian:bullseye-slim AS STANDARD
LABEL MAINTAINER="https://hanzo.ai/"
ARG USER=hanzo
ARG TARGETOS
ARG TARGETARCH
ENV BUILDX_ARCH="${TARGETOS:-linux}_${TARGETARCH:-amd64}"

RUN apt-get update && apt-get install -y \
    sudo \
    tzdata \
    curl \
    ca-certificates \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 -s /bin/bash $USER \
    && echo "$USER ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/$USER \
    && chmod 0440 /etc/sudoers.d/$USER \
    && mkdir logs \
    && chown -R $USER:$USER logs

USER 1000
WORKDIR /
COPY --from=BACK --chown=$USER:$USER /go/src/hanzo-id/server_${BUILDX_ARCH} ./server
COPY --from=BACK --chown=$USER:$USER /go/src/hanzo-id/swagger ./swagger
COPY --from=BACK --chown=$USER:$USER /go/src/hanzo-id/conf/app.conf ./conf/app.conf
COPY --from=BACK --chown=$USER:$USER /go/src/hanzo-id/version_info.txt ./go/src/hanzo-id/version_info.txt
COPY --from=FRONT --chown=$USER:$USER /web/build ./web/build

ENTRYPOINT ["/server"]


FROM debian:latest AS db
RUN apt update \
    && apt install -y \
    mariadb-server \
    mariadb-client \
    && rm -rf /var/lib/apt/lists/*


FROM db AS ALLINONE
LABEL MAINTAINER="https://hanzo.ai/"
ARG TARGETOS
ARG TARGETARCH
ENV BUILDX_ARCH="${TARGETOS:-linux}_${TARGETARCH:-amd64}"

RUN apt update
RUN apt install -y ca-certificates && update-ca-certificates

WORKDIR /
COPY --from=BACK /go/src/hanzo-id/server_${BUILDX_ARCH} ./server
COPY --from=BACK /go/src/hanzo-id/swagger ./swagger
COPY --from=BACK /go/src/hanzo-id/docker-entrypoint.sh /docker-entrypoint.sh
COPY --from=BACK /go/src/hanzo-id/conf/app.conf ./conf/app.conf
COPY --from=BACK /go/src/hanzo-id/version_info.txt ./go/src/hanzo-id/version_info.txt
COPY --from=FRONT /web/build ./web/build

ENTRYPOINT ["/bin/bash"]
CMD ["/docker-entrypoint.sh"]
