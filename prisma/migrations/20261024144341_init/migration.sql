-- Guard: lists are sorted with the database's default collation, which must be ICU so the order
-- matches the mock API's locale-aware sorting (compose and Testcontainers initialise it that way).
DO $$
BEGIN
  IF (SELECT datlocprovider FROM pg_database WHERE datname = current_database()) <> 'i' THEN
    RAISE EXCEPTION 'The database must use the ICU locale provider (initdb --locale-provider=icu --icu-locale=und)';
  END IF;
END
$$;

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('admin', 'manager');

-- CreateEnum
CREATE TYPE "location_status" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "room_type" AS ENUM ('meeting_room', 'private_office', 'hot_desk', 'event_space');

-- CreateEnum
CREATE TYPE "room_status" AS ENUM ('available', 'maintenance', 'retired');

-- CreateEnum
CREATE TYPE "amenity" AS ENUM ('projector', 'whiteboard', 'video_conferencing', 'phone', 'standing_desks', 'natural_light');

-- CreateEnum
CREATE TYPE "member_plan" AS ENUM ('day_pass', 'flex', 'dedicated', 'team');

-- CreateEnum
CREATE TYPE "member_status" AS ENUM ('active', 'suspended', 'cancelled');

-- CreateEnum
CREATE TYPE "booking_status" AS ENUM ('pending', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "user_role" NOT NULL,
    "password_hash" TEXT NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" TEXT NOT NULL,
    "seq" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "opens_at" TEXT NOT NULL,
    "closes_at" TEXT NOT NULL,
    "status" "location_status" NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" TEXT NOT NULL,
    "seq" BIGINT NOT NULL,
    "location_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "room_type" NOT NULL,
    "capacity" INTEGER NOT NULL,
    "hourly_rate" INTEGER NOT NULL,
    "amenities" "amenity"[],
    "status" "room_status" NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "members" (
    "id" TEXT NOT NULL,
    "seq" BIGINT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "company" TEXT,
    "plan" "member_plan" NOT NULL,
    "status" "member_status" NOT NULL,
    "joined_at" DATE NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "seq" BIGINT NOT NULL,
    "room_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "attendees" INTEGER NOT NULL,
    "status" "booking_status" NOT NULL,
    "notes" TEXT,
    "total_price" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "locations_seq_key" ON "locations"("seq");

-- CreateIndex
CREATE INDEX "locations_name_seq_idx" ON "locations"("name", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_seq_key" ON "rooms"("seq");

-- CreateIndex
CREATE INDEX "rooms_location_id_idx" ON "rooms"("location_id");

-- CreateIndex
CREATE INDEX "rooms_name_seq_idx" ON "rooms"("name", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "members_seq_key" ON "members"("seq");

-- CreateIndex
CREATE INDEX "members_last_name_first_name_seq_idx" ON "members"("last_name", "first_name", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_seq_key" ON "bookings"("seq");

-- CreateIndex
CREATE INDEX "bookings_starts_at_seq_idx" ON "bookings"("starts_at" DESC, "seq");

-- CreateIndex
CREATE INDEX "bookings_room_id_starts_at_idx" ON "bookings"("room_id", "starts_at");

-- CreateIndex
CREATE INDEX "bookings_member_id_idx" ON "bookings"("member_id");

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written SQL that Prisma cannot express in schema.prisma.

-- Shared id counter: `loc_1`, `room_6`, `mem_12`, `bk_3a` are the prefix and the base36 counter.
CREATE SEQUENCE "entity_seq";

-- A booking ends after it starts.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_ends_after_starts" CHECK ("ends_at" > "starts_at");

-- Two bookings that occupy a room never overlap. The range is half-open, so back-to-back bookings
-- (the seed has many) are fine; the application checks first and answers 409, this is the backstop.
CREATE EXTENSION IF NOT EXISTS "btree_gist";

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_room_no_overlap" EXCLUDE USING gist (
  "room_id" WITH =,
  tstzrange("starts_at", "ends_at", '[)') WITH &&
) WHERE ("status" IN ('pending', 'confirmed', 'checked_in'));

-- An email belongs to one member that is not deleted (emails are stored in lower case).
CREATE UNIQUE INDEX "members_email_key" ON "members" ("email") WHERE "deleted_at" IS NULL;
