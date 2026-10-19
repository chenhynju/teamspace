BEGIN;
-- AlterTable
ALTER TABLE "org_organization" ADD COLUMN     "checkout_expires_at" TIMESTAMP(3),
ADD COLUMN     "checkout_plan_key" TEXT,
ADD COLUMN     "checkout_session_id" TEXT,
ADD COLUMN     "checkout_url" TEXT,
ADD COLUMN     "stripe_customer_id" TEXT;

-- AlterTable
ALTER TABLE "prj_project" ADD COLUMN     "visibility" TEXT NOT NULL DEFAULT 'ORGANIZATION';

-- AlterTable
ALTER TABLE "bill_subscription" ADD COLUMN     "external_id" TEXT,
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'sandbox';

-- CreateTable
CREATE TABLE "org_collaboration_group" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'TEAM',
    "description" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_collaboration_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_group_member" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',

    CONSTRAINT "org_group_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_resource_grant" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "access" TEXT NOT NULL DEFAULT 'READ',

    CONSTRAINT "org_resource_grant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "org_collaboration_group_organization_id_name_key" ON "org_collaboration_group"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "org_collaboration_group_id_organization_id_key" ON "org_collaboration_group"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "org_group_member_group_id_membership_id_key" ON "org_group_member"("group_id", "membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "org_resource_grant_group_id_project_id_key" ON "org_resource_grant"("group_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "org_organization_stripe_customer_id_key" ON "org_organization"("stripe_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "org_membership_id_organization_id_key" ON "org_membership"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "prj_project_id_organization_id_key" ON "prj_project"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "bill_subscription_external_id_key" ON "bill_subscription"("external_id");

-- AddForeignKey
ALTER TABLE "org_collaboration_group" ADD CONSTRAINT "org_collaboration_group_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "org_organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_group_member" ADD CONSTRAINT "org_group_member_group_id_organization_id_fkey" FOREIGN KEY ("group_id", "organization_id") REFERENCES "org_collaboration_group"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_group_member" ADD CONSTRAINT "org_group_member_membership_id_organization_id_fkey" FOREIGN KEY ("membership_id", "organization_id") REFERENCES "org_membership"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_resource_grant" ADD CONSTRAINT "org_resource_grant_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "org_organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_resource_grant" ADD CONSTRAINT "org_resource_grant_group_id_organization_id_fkey" FOREIGN KEY ("group_id", "organization_id") REFERENCES "org_collaboration_group"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_resource_grant" ADD CONSTRAINT "org_resource_grant_project_id_organization_id_fkey" FOREIGN KEY ("project_id", "organization_id") REFERENCES "prj_project"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "org_collaboration_group" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "org_collaboration_group" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_collaboration_group_iso" ON "org_collaboration_group" USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')) WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), ''));
ALTER TABLE "org_group_member" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "org_group_member" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_group_member_iso" ON "org_group_member" USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')) WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), ''));
ALTER TABLE "org_resource_grant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "org_resource_grant" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_resource_grant_iso" ON "org_resource_grant" USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')) WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), ''));
ALTER TABLE prj_project ADD CONSTRAINT project_visibility_valid CHECK (visibility IN ('ORGANIZATION','RESTRICTED'));
ALTER TABLE org_group_member ADD CONSTRAINT group_role_valid CHECK (role IN ('MEMBER','MANAGER'));
ALTER TABLE org_resource_grant ADD CONSTRAINT resource_access_valid CHECK (access IN ('READ','WRITE','MANAGE'));
GRANT SELECT,INSERT,UPDATE,DELETE ON org_collaboration_group,org_group_member,org_resource_grant TO teamspace_app;
COMMIT;
