#!/bin/bash
# Graded frames + the mix -> the film: a full encode for desktop, a small one for web and phones.
#   tools/film/encode.sh <frames-dir> <mix.wav> <out-dir> <name>
set -e
F=$1; A=$2; O=$3; N=$4; mkdir -p "$O"
AF="loudnorm=I=-18:TP=-1.5:LRA=14"
ffmpeg -y -loglevel error -framerate 24 -start_number 0 -i "$F/%05d.png" -i "$A" -af "$AF" -c:v libx264 -preset slow -crf 19 -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 192k -shortest "$O/$N-720.mp4"
ffmpeg -y -loglevel error -i "$O/$N-720.mp4" -vf scale=854:-2:flags=lanczos -c:v libx264 -preset slow -crf 25 -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 112k "$O/$N-480.mp4"
ls -la "$O"/$N-*.mp4 | awk '{printf "%s %.1f MB\n",$9,$5/1e6}'
