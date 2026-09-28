FROM alpine:3.20 AS download

RUN apk add --no-cache ca-certificates curl
RUN curl --fail --location --retry 3 \
      'https://github.com/minio/minio/releases/download/RELEASE.2024-12-18T13-15-44Z/minio.linux-amd64.RELEASE.2024-12-18T13-15-44Z' \
      --output /tmp/minio \
    && echo '88182336ab5793488f2caad54846056b330f0dcb5c488b60d52434beeebae3ca  /tmp/minio' \
      | sha256sum -c

FROM alpine:3.20

RUN apk add --no-cache ca-certificates
COPY --from=download /tmp/minio /usr/local/bin/minio
RUN chmod 0755 /usr/local/bin/minio
EXPOSE 9000 9001
ENTRYPOINT ["/usr/local/bin/minio"]
