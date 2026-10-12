CREATE TYPE "Role" AS ENUM ('CUSTOMER','RESELLER','ADMIN','SUPER_ADMIN');
CREATE TYPE "OrderStatus" AS ENUM ('AWAITING_PAYMENT','PENDING_REVIEW','REJECTED','PAID','CANCELLED');
CREATE TYPE "OrderKind" AS ENUM ('PRODUCT','PLAN');
CREATE TYPE "ProofStatus" AS ENUM ('PENDING','APPROVED','REJECTED');
CREATE TABLE "User" (
 "id" TEXT PRIMARY KEY,"email" TEXT NOT NULL,"passwordHash" TEXT NOT NULL,"role" "Role" NOT NULL DEFAULT 'CUSTOMER',
 "active" BOOLEAN NOT NULL DEFAULT true,"displayName" TEXT NOT NULL DEFAULT '',"storeName" TEXT NOT NULL DEFAULT '',
 "telegramId" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");
CREATE TABLE "Session" (
 "id" TEXT PRIMARY KEY,"tokenHash" TEXT NOT NULL,"csrfToken" TEXT NOT NULL,"expiresAt" TIMESTAMP(3) NOT NULL,"userId" TEXT NOT NULL,
 CONSTRAINT "Session_userId_fkey" FOREIGN KEY("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE TABLE "Product" (
 "id" TEXT PRIMARY KEY,"sellerId" TEXT NOT NULL,"title" TEXT NOT NULL,"description" TEXT NOT NULL DEFAULT '',"category" TEXT NOT NULL DEFAULT 'Umum',
 "price" INTEGER NOT NULL CHECK("price">0),"stock" INTEGER NOT NULL DEFAULT 0 CHECK("stock">=0),"approved" BOOLEAN NOT NULL DEFAULT false,
 "active" BOOLEAN NOT NULL DEFAULT true,"platformFeeBps" INTEGER NOT NULL DEFAULT 1000 CHECK("platformFeeBps" BETWEEN 0 AND 10000),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "Product_sellerId_fkey" FOREIGN KEY("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "DigitalUnit" (
 "id" TEXT PRIMARY KEY,"productId" TEXT NOT NULL,"ciphertext" TEXT NOT NULL,"consumed" BOOLEAN NOT NULL DEFAULT false,
 "deliveredOrderId" TEXT,"deliveredBuyerId" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(NOT "consumed" OR ("deliveredOrderId" IS NOT NULL AND "deliveredBuyerId" IS NOT NULL)),
 CONSTRAINT "DigitalUnit_productId_fkey" FOREIGN KEY("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "DigitalUnit_productId_consumed_idx" ON "DigitalUnit"("productId","consumed");
CREATE INDEX "DigitalUnit_deliveredOrderId_deliveredBuyerId_idx" ON "DigitalUnit"("deliveredOrderId","deliveredBuyerId");
CREATE TABLE "Plan" (
 "id" TEXT PRIMARY KEY,"name" TEXT NOT NULL,"price" INTEGER NOT NULL CHECK("price">0),"durationDays" INTEGER CHECK("durationDays">0),
 "productLimit" INTEGER NOT NULL CHECK("productLimit">0),"platformFeeBps" INTEGER NOT NULL CHECK("platformFeeBps" BETWEEN 0 AND 10000),"active" BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX "Plan_name_key" ON "Plan"("name");
CREATE TABLE "Subscription" (
 "id" TEXT PRIMARY KEY,"userId" TEXT NOT NULL,"planId" TEXT NOT NULL,"orderId" TEXT NOT NULL,"startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expiresAt" TIMESTAMP(3),"productLimit" INTEGER NOT NULL CHECK("productLimit">0),"platformFeeBps" INTEGER NOT NULL CHECK("platformFeeBps" BETWEEN 0 AND 10000),"revoked" BOOLEAN NOT NULL DEFAULT false,
 CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Subscription_orderId_key" ON "Subscription"("orderId");
CREATE INDEX "Subscription_userId_revoked_idx" ON "Subscription"("userId","revoked");
CREATE TABLE "Order" (
 "id" TEXT PRIMARY KEY,"buyerId" TEXT NOT NULL,"requestKey" TEXT NOT NULL,"kind" "OrderKind" NOT NULL DEFAULT 'PRODUCT',"planId" TEXT,"planSnapshot" JSONB,"promoCode" TEXT,
 "status" "OrderStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',"total" INTEGER NOT NULL CHECK("total">0),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"paidAt" TIMESTAMP(3),
 CHECK(("kind"='PLAN' AND "planId" IS NOT NULL AND "planSnapshot" IS NOT NULL) OR ("kind"='PRODUCT' AND "planId" IS NULL)),
 CONSTRAINT "Order_buyerId_fkey" FOREIGN KEY("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "Order_planId_fkey" FOREIGN KEY("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Order_buyerId_requestKey_key" ON "Order"("buyerId","requestKey");
CREATE TABLE "OrderItem" (
 "id" TEXT PRIMARY KEY,"orderId" TEXT NOT NULL,"productId" TEXT NOT NULL,"sellerIdSnapshot" TEXT NOT NULL,"titleSnapshot" TEXT NOT NULL,
 "priceSnapshot" INTEGER NOT NULL CHECK("priceSnapshot">0),"platformFeeBpsSnapshot" INTEGER NOT NULL CHECK("platformFeeBpsSnapshot" BETWEEN 0 AND 10000),"quantity" INTEGER NOT NULL CHECK("quantity">0),
 CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "PaymentProof" (
 "id" TEXT PRIMARY KEY,"orderId" TEXT NOT NULL,"version" INTEGER NOT NULL CHECK("version">0),"storageKey" TEXT NOT NULL,
 "status" "ProofStatus" NOT NULL DEFAULT 'PENDING',"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"reviewedAt" TIMESTAMP(3),"reviewerId" TEXT,"rejectionReason" TEXT,
 CHECK("status"<>'REJECTED' OR ("rejectionReason" IS NOT NULL AND length(trim("rejectionReason"))>=3)),
 CONSTRAINT "PaymentProof_orderId_fkey" FOREIGN KEY("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PaymentProof_orderId_version_key" ON "PaymentProof"("orderId","version");
CREATE TABLE "Commission" (
 "id" TEXT PRIMARY KEY,"itemId" TEXT NOT NULL,"sellerId" TEXT NOT NULL,"gross" INTEGER NOT NULL,"platformFee" INTEGER NOT NULL,"net" INTEGER NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK("gross">0 AND "platformFee">=0 AND "net">=0 AND "gross"="platformFee"+"net"),
 CONSTRAINT "Commission_itemId_fkey" FOREIGN KEY("itemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "Commission_sellerId_fkey" FOREIGN KEY("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Commission_itemId_key" ON "Commission"("itemId");
CREATE TABLE "Media" (
 "id" TEXT PRIMARY KEY,"key" TEXT NOT NULL,"ownerId" TEXT NOT NULL,"mime" TEXT NOT NULL,"size" INTEGER NOT NULL CHECK("size">0),"public" BOOLEAN NOT NULL DEFAULT false,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "Media_key_key" ON "Media"("key");
CREATE TABLE "Setting" ("key" TEXT PRIMARY KEY,"value" JSONB NOT NULL,"updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "Promo" ("code" TEXT PRIMARY KEY,"percent" INTEGER NOT NULL CHECK("percent" BETWEEN 1 AND 90),"expiresAt" TIMESTAMP(3) NOT NULL,"active" BOOLEAN NOT NULL DEFAULT true);
CREATE TABLE "Notification" ("id" TEXT PRIMARY KEY,"userId" TEXT NOT NULL,"message" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"readAt" TIMESTAMP(3));
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId","createdAt");
CREATE TABLE "AuditLog" ("id" TEXT PRIMARY KEY,"actorId" TEXT NOT NULL,"action" TEXT NOT NULL,"resourceId" TEXT NOT NULL,"details" JSONB NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "Outbox" ("id" TEXT PRIMARY KEY,"key" TEXT NOT NULL,"topic" TEXT NOT NULL,"payload" JSONB NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"sentAt" TIMESTAMP(3),"attempts" INTEGER NOT NULL DEFAULT 0,"lockedUntil" TIMESTAMP(3),"lastError" TEXT);
CREATE UNIQUE INDEX "Outbox_key_key" ON "Outbox"("key");
CREATE INDEX "Outbox_sentAt_lockedUntil_idx" ON "Outbox"("sentAt","lockedUntil");
CREATE TABLE "LoginThrottle" ("key" TEXT PRIMARY KEY,"failures" INTEGER NOT NULL DEFAULT 0,"windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "PasswordReset" ("id" TEXT PRIMARY KEY,"userId" TEXT NOT NULL,"tokenHash" TEXT NOT NULL,"expiresAt" TIMESTAMP(3) NOT NULL,"usedAt" TIMESTAMP(3));
CREATE UNIQUE INDEX "PasswordReset_tokenHash_key" ON "PasswordReset"("tokenHash");
CREATE TABLE "BotConversation" ("key" TEXT PRIMARY KEY,"actorId" TEXT NOT NULL,"action" TEXT NOT NULL,"payload" JSONB NOT NULL,"expiresAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "TelegramLink" ("tokenHash" TEXT PRIMARY KEY,"userId" TEXT NOT NULL,"expiresAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "BootstrapMarker" ("id" TEXT PRIMARY KEY,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
