FROM denoland/deno:latest as base

WORKDIR /

COPY . ./

RUN deno cache mod.ts

CMD ["task", "start"]