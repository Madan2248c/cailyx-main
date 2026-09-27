-- CreateTable
CREATE TABLE "google_connections" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "scopes" TEXT[],
    "refresh_token_encrypted" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "google_connections_client_id_key" ON "google_connections"("client_id");

-- AddForeignKey
ALTER TABLE "google_connections" ADD CONSTRAINT "google_connections_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
