FROM ubuntu:latest@sha256:b6b83d3c331794420340093eb706a6f152d9c1fa51b262d9bf34594887c2c7ac

ENV LANG C.UTF-8

RUN apt-get update && \
    apt-get install -yq --no-install-recommends ca-certificates curl python2 build-essential rsync openssh-client && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*
RUN curl -L https://raw.githubusercontent.com/tj/n/master/bin/n -o n && \
    bash n latest && \
    rm -rf n /usr/local/n
RUN npm install -g nodemon

WORKDIR /usr/app
EXPOSE 3000

RUN curl -L https://github.com/krallin/tini/releases/download/v0.19.0/tini --output /tini && chmod +x /tini
ENTRYPOINT ["/tini", "--"]

COPY package*.json ./
RUN npm install
COPY . .

CMD ["node", "server.js"]
