FROM node

WORKDIR /usr/app

RUN apt-get update && apt-get install -y openssh-client rsync

RUN npm install -g nodemon

COPY package*.json ./
RUN npm install
COPY . .

EXPOSE 3000

CMD ["npm", "start"]
