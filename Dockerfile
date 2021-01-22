FROM ubuntu

RUN apt-get update && \
    apt-get install -y curl python build-essential rsync openssh-client
RUN curl -L https://raw.githubusercontent.com/tj/n/master/bin/n -o n && \
    bash n latest && \
    rm -rf n /usr/local/n
RUN npm install -g nodemon

WORKDIR /usr/app

COPY package*.json ./
RUN npm install
COPY . .

EXPOSE 3000

ENV TINI_VERSION v0.19.0
ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini /tini
RUN chmod +x /tini
ENTRYPOINT ["/tini", "--"]

CMD ["node", "server.js"]
