-- CreateTable
CREATE TABLE "BasketItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BasketItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BasketItem_productId_idx" ON "BasketItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "BasketItem_userId_productId_key" ON "BasketItem"("userId", "productId");

-- AddForeignKey
ALTER TABLE "BasketItem" ADD CONSTRAINT "BasketItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BasketItem" ADD CONSTRAINT "BasketItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
