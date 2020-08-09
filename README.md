# Docker Backup

register backup jobs in docker labels.
restore backups on any docker host

# backup usage

    node backup.js user host

optional filter [mysqldump/mongodump]

    node backup.js user host mysqldump

# restore usage

Automatic mode : inquire will ask questions

    node restore.js

Manual mode :

    node restore.js remoteUser remoteHost remoteContainer filesToRestore
    node restore.js root exemple.net mysql /backup/exemple.net/mysql/mysqldump/2020-05-20--01/exemple.sql.gz 

# install

- install dockerbackup on the backup server

        git clone https://github.com/rafipiccolo/dockerbackup.git dockerbackup

- verify that you can connect to the production server with ssh (using private key)

        ssh root@exemple.com

- on the production server

    add labels to the containers you want to backup

    exemple of docker-compose.yml :

        version: "3.3"
            services:
                mongo:
                    image: mongo
                    container_name: mongo
                    restart: always
                    volumes:
                        - ./mongo:/data/db
                    labels:
                        - "backup.driver=mongo"

                mysql:
                    image: mysql
                    container_name: mysql
                    restart: always
                    environment:
                        - MYSQL_ROOT_PASSWORD=${PASSWORD}
                    volumes:
                        - ./mysql:/var/lib/mysql
                    labels:
                        - "backup.driver=mysqldump"
                        - "backup.ignore=sys,performance_schema,information_schema,mysql"
                        #
                        # dockerbackup will read env to get MYSQL_ROOT_PASSWORD automatically
                        # 
                        # you can ignore : (separate entries by ',')
                        #   entire databases like this : sys,mysql
                        #   or tables like this : test.tableA
                        #   or both : sys,test.tableA

- on the backup server :

    run dockerbackup

        node backup.js root exemple.com

    mongodumps will be stored in /backup/{host}/{containerName}/mongodump/{now}/{db}.sql.gz

    mysqldumps will be stored in /backup/{host}/{containerName}/mysqldump/{now}/{db}.archive

# environment

- VERBOSE : default false
- INFLUXDB : specify an influxdb url to write metrics
- DRYRUN : do not execute

# Update

    cd dockerbackup
    git pull

# How it works

We call docker inspect on the remote host from ssh to get all running containers labels.
We parse it and execute a backup script for every job we found.
