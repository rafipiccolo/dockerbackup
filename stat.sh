#!/bin/bash

shopt -s nullglob

main () {
    date;

    echo disk usage;
    df -h /;

    echo RSYNCLIVE;
    for DIR in /backup/*/ ; do
        echo $DIR;
        if [ -n "$DIR/rsynclive" ] ; then
            du -hs $DIR/rsynclive;
        fi

        echo;
    done

    echo RSYNC;
    for DIR in /backup/*/ ; do
        echo $DIR;
        DIRS=$(compgen -G "$DIR/all/*")
        if [ -n "$DIRS" ] ; then
            du -chs $DIR/all/*;
        fi

        echo;
    done

    echo 'MYSQL';
    DIRS=$(compgen -G "/backup/*/mysql")
    if [ -n "$DIRS" ] ; then
        du -chs /backup/*/mysql;
    fi

    echo;
    date;
}

main > /backup/stat.txt;
