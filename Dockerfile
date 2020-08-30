FROM node

WORKDIR /usr/app

RUN npm install -g nodemon

RUN apt-get update && apt-get install -y openssh-client rsync

COPY package*.json ./
RUN npm install
COPY . .

EXPOSE 3000

CMD ["npm", "start"]
