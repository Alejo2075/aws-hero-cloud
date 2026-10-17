# @hero-cloud/plugin-container

Detector for applications that ship a `Dockerfile`. A Dockerfile alone (no `package.json`) describes a
web service on the port it `EXPOSE`s; next to a Node project it is only noted, because the simpler way
to run the application wins.
