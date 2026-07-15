# syntax=docker/dockerfile:1
# ---- build stage ----
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY pom.xml ./
RUN mvn -B -q dependency:go-offline
COPY src ./src
RUN mvn -B -q clean package -DskipTests

# ---- runtime stage ----
FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app
# curl is needed for the compose healthcheck (not present in the JRE base image).
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/target/rates-service.jar app.jar
ENV SERVER_PORT=8080
EXPOSE 8080
CMD ["java", "-jar", "app.jar"]
