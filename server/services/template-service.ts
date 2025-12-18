import { db } from '../lib/db';
import { courseTemplates, type CourseTemplate, type InsertCourseTemplate } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

export async function getAllTemplates(): Promise<CourseTemplate[]> {
  try {
    const templates = await db
      .select()
      .from(courseTemplates)
      .orderBy(courseTemplates.isDefault, courseTemplates.name);
    
    logger.info('Templates fetched', { count: templates.length });
    return templates;
  } catch (error) {
    logger.error('Error fetching templates', { error });
    throw new Error('Failed to fetch templates');
  }
}

export async function getTemplateById(id: string): Promise<CourseTemplate | null> {
  try {
    const [template] = await db
      .select()
      .from(courseTemplates)
      .where(eq(courseTemplates.id, id))
      .limit(1);
    
    return template || null;
  } catch (error) {
    logger.error('Error fetching template', { id, error });
    throw new Error('Failed to fetch template');
  }
}

export async function createTemplate(template: InsertCourseTemplate): Promise<CourseTemplate> {
  try {
    const [created] = await db
      .insert(courseTemplates)
      .values(template)
      .returning();
    
    logger.info('Template created', { id: created.id, name: created.name });
    return created;
  } catch (error) {
    logger.error('Error creating template', { error });
    throw new Error('Failed to create template');
  }
}

export async function updateTemplate(
  id: string,
  updates: Partial<InsertCourseTemplate>
): Promise<CourseTemplate> {
  try {
    const [updated] = await db
      .update(courseTemplates)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(courseTemplates.id, id))
      .returning();
    
    if (!updated) {
      throw new Error('Template not found');
    }
    
    logger.info('Template updated', { id });
    return updated;
  } catch (error) {
    logger.error('Error updating template', { id, error });
    throw new Error('Failed to update template');
  }
}

export async function deleteTemplate(id: string): Promise<void> {
  try {
    await db
      .delete(courseTemplates)
      .where(eq(courseTemplates.id, id));
    
    logger.info('Template deleted', { id });
  } catch (error) {
    logger.error('Error deleting template', { id, error });
    throw new Error('Failed to delete template');
  }
}
