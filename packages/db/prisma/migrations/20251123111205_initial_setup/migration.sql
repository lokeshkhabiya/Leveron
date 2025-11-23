-- CreateTable
CREATE TABLE "users" (
    "user_id" UUID NOT NULL,
    "email" VARCHAR(255),

    CONSTRAINT "users_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
