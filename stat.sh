#!/bin/bash

main () {
    date;

    echo disk usage;
    df -h /;

    for DIR in /backup/*/ ; do
        echo $DIR;
        du -chs $DIR/all/*;
        echo;
    done

    echo 'mysql';
    du -chs /backup/*/mysql;

    echo;
    date;
}

main > /backup/stat2.txt;
