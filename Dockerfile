FROM ubuntu:latest@sha256:4b1d0c4a2d2aaf63b37111f34eb9fa89fa1bf53dd6e4ca954d47caebca4005c2

ENV LANG C.UTF-8

RUN apt-get update && \
    apt-get install -yq --no-install-recommends ca-certificates curl python2 build-essential rsync openssh-client && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*
RUN curl -L https://raw.githubusercontent.com/tj/n/master/bin/n -o n && \
    bash n latest && \
    rm -rf n /usr/local/n

WORKDIR /usr/app
EXPOSE 3000

RUN curl -L https://github.com/krallin/tini/releases/download/v0.19.0/tini --output /tini && chmod +x /tini
ENTRYPOINT ["/tini", "--"]

COPY package*.json ./
RUN npm install
COPY . .

CMD ["node", "server.js"]
