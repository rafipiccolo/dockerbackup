#!/bin/bash

main() {
    for DIR in /backup/* ; do
        echo $DIR
        du -chs $DIR/all/*;
        echo
    done

    echo 'mysql'
    du -chs /backup/*/mysql
}

main > /backup/stat.txt
