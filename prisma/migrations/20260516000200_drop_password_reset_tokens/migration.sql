-- DropForeignKey
ALTER TABLE "PasswordResetToken" DROP CONSTRAINT IF EXISTS "PasswordResetToken_userId_fkey";

-- DropTable
DROP TABLE IF EXISTS "PasswordResetToken";
