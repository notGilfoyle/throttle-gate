# Dev-oriented image: runs the Vite dev server (with HMR + /api proxy).
# A production build would use `npm run build` + a static server; out of scope for now.
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host"]
