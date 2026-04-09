FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3000

ENV PORT=3000
ENV EXPIRE_HOURS=168

# 单用户模式（默认）
# ENV ACCESS_PASSWORD=yourpassword

# 多用户模式
# ENV ACCESS_PASSWORDS=user1:pass1,user2:pass2,user3:pass3
# ENV MIGRATE_DEFAULT_USER=user1

CMD ["node", "server.js"]