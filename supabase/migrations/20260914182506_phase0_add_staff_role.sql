/*
# Phase 0: Add 'staff' to user role enum

## Purpose
The application code references four roles: student, coach, staff, admin.
The database enum `role` only has three values. This migration adds 'staff'.

## Changes
1. Adds 'staff' value to the existing `role` PostgreSQL enum type.
   Additive, data-preserving, idempotent.

## Rollback
Postgres does not support removing enum values. To reverse, simply stop using
'sstaff' in application code. No data is lost.
*/

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON e.enumtypid = t.oid
        WHERE t.typname = 'role' AND e.enumlabel = 'staff'
    ) THEN
        ALTER TYPE role ADD VALUE 'staff' AFTER 'coach';
    END IF;
END $$;
