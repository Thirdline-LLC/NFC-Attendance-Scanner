import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addBodyFieldDef,
  addBodyTypeDef,
  BodyVocabError,
  createBody,
  deleteBodyFieldDef,
  deleteBodyTypeDef,
  getActiveBody,
  listBodies,
  listBodyFieldDefs,
  listBodyTypeDefs,
  renameBody,
  renameBodyTypeDef,
  updateBodyCustomFields,
  updateBodyFieldDef,
} from './attendance-store';

const DATABASE_NAME = 'attendance-scanner-local';

describe('body-type vocabulary', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

  it('starts a fresh device with the seeded body already in the vocabulary', async () => {
    const typeDefs = await listBodyTypeDefs();
    expect(typeDefs.map((def) => def.label)).toEqual(['club']);
  });

  it('adds a typed-in entry and refuses a case-insensitive duplicate', async () => {
    const added = await addBodyTypeDef('Branch');
    expect(added.label).toBe('Branch');

    await expect(addBodyTypeDef('branch')).rejects.toThrow(BodyVocabError);
    await expect(addBodyTypeDef('  ')).rejects.toThrow(BodyVocabError);

    expect((await listBodyTypeDefs()).map((def) => def.label)).toEqual([
      'club',
      'Branch',
    ]);
  });

  it('creating a body with a new label adds it to the vocabulary once', async () => {
    await createBody({ name: 'Debate', typeLabel: 'Section' });
    await createBody({ name: 'Chess', typeLabel: 'section' });

    expect((await listBodyTypeDefs()).map((def) => def.label)).toEqual([
      'club',
      'Section',
    ]);
  });

  it('renaming a body with a new label adds it too', async () => {
    const body = await createBody({ name: 'Debate', typeLabel: 'club' });

    await renameBody(body.id as number, { name: 'Debate', typeLabel: 'Program' });

    expect((await listBodyTypeDefs()).map((def) => def.label)).toEqual([
      'club',
      'Program',
    ]);
  });

  it('does not resurrect a deleted vocabulary entry on a name-only rename', async () => {
    const typeDef = await addBodyTypeDef('Branch');
    const body = await createBody({ name: 'Finance', typeLabel: 'Branch' });
    await deleteBodyTypeDef(typeDef.id as number);
    expect((await listBodyTypeDefs()).map((def) => def.label)).not.toContain('Branch');

    await renameBody(body.id as number, { name: 'Finance Desk', typeLabel: 'Branch' });

    expect((await listBodyTypeDefs()).map((def) => def.label)).not.toContain('Branch');
  });

  it('refuses to change a body onto a type with a required field it does not have', async () => {
    await addBodyFieldDef({
      label: 'Advisor',
      appliesToTypeLabel: 'team',
      required: true,
    });
    const body = await createBody({ name: 'Robotics', typeLabel: 'club' });

    await expect(
      renameBody(body.id as number, { name: 'Robotics', typeLabel: 'team' }),
    ).rejects.toThrow(BodyVocabError);
    expect((await listBodies()).find((b) => b.id === body.id)?.typeLabel).toBe('club');

    await updateBodyCustomFields(body.id as number, { Advisor: 'a@b.org' });
    await renameBody(body.id as number, { name: 'Robotics', typeLabel: 'team' });
    expect((await listBodies()).find((b) => b.id === body.id)?.typeLabel).toBe('team');
  });

  it('changes a type and its newly-required field in one atomic rename', async () => {
    await addBodyFieldDef({
      label: 'Advisor',
      appliesToTypeLabel: 'team',
      required: true,
    });
    const body = await createBody({ name: 'Robotics', typeLabel: 'club' });

    // No prior `updateBodyCustomFields` call — the field value rides along
    // with the type change in a single write.
    const renamed = await renameBody(body.id as number, {
      name: 'Robotics',
      typeLabel: 'team',
      customFields: { Advisor: 'a@b.org' },
    });

    expect(renamed.typeLabel).toBe('team');
    expect(renamed.customFields).toEqual({ Advisor: 'a@b.org' });
    const saved = (await listBodies()).find((b) => b.id === body.id);
    expect(saved?.typeLabel).toBe('team');
    expect(saved?.customFields).toEqual({ Advisor: 'a@b.org' });
  });

  it('still refuses an atomic rename that leaves a required field blank', async () => {
    await addBodyFieldDef({
      label: 'Advisor',
      appliesToTypeLabel: 'team',
      required: true,
    });
    const body = await createBody({ name: 'Robotics', typeLabel: 'club' });

    await expect(
      renameBody(body.id as number, {
        name: 'Robotics',
        typeLabel: 'team',
        customFields: { Advisor: '  ' },
      }),
    ).rejects.toThrow(BodyVocabError);
    expect((await listBodies()).find((b) => b.id === body.id)?.typeLabel).toBe('club');
  });

  it('renaming a vocabulary entry rewrites every body and field def that used it', async () => {
    const typeDef = await addBodyTypeDef('Branch');
    const finance = await createBody({ name: 'Finance', typeLabel: 'Branch' });
    const field = await addBodyFieldDef({
      label: 'Budget code',
      appliesToTypeLabel: 'Branch',
      required: false,
    });

    await renameBodyTypeDef(typeDef.id as number, 'Division');

    const fieldDefs = await listBodyFieldDefs();
    expect(fieldDefs.find((def) => def.id === field.id)?.appliesToTypeLabel).toBe(
      'Division',
    );
    const renamedFinance = (await listBodies()).find((b) => b.id === finance.id);
    expect(renamedFinance?.typeLabel).toBe('Division');
  });

  it('cascades a casing-only rename too, not just a spelling change', async () => {
    const typeDef = await addBodyTypeDef('Branch');
    const finance = await createBody({ name: 'Finance', typeLabel: 'Branch' });
    const field = await addBodyFieldDef({
      label: 'Budget code',
      appliesToTypeLabel: 'Branch',
      required: false,
    });

    await renameBodyTypeDef(typeDef.id as number, 'branch');

    const fieldDefs = await listBodyFieldDefs();
    expect(fieldDefs.find((def) => def.id === field.id)?.appliesToTypeLabel).toBe(
      'branch',
    );
    const renamedFinance = (await listBodies()).find((b) => b.id === finance.id);
    expect(renamedFinance?.typeLabel).toBe('branch');
  });

  it('refuses to rename a vocabulary entry onto an existing label', async () => {
    await addBodyTypeDef('Branch');
    const other = await addBodyTypeDef('Section');

    await expect(renameBodyTypeDef(other.id as number, 'branch')).rejects.toThrow(
      BodyVocabError,
    );
  });

  it('deleting a vocabulary entry leaves bodies already using that label untouched', async () => {
    const typeDef = await addBodyTypeDef('Branch');
    const finance = await createBody({ name: 'Finance', typeLabel: 'Branch' });

    await deleteBodyTypeDef(typeDef.id as number);

    expect((await listBodyTypeDefs()).map((def) => def.label)).not.toContain('Branch');
    const stillFinance = (await listBodies()).find((b) => b.id === finance.id);
    expect(stillFinance?.typeLabel).toBe('Branch');
  });
});

describe('custom-field definitions', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

  it('adds, updates and deletes a field definition', async () => {
    const field = await addBodyFieldDef({
      label: 'Room',
      appliesToTypeLabel: 'club',
      required: false,
    });
    expect((await listBodyFieldDefs()).map((def) => def.label)).toEqual(['Room']);

    await updateBodyFieldDef(field.id as number, {
      label: 'Room number',
      appliesToTypeLabel: 'club',
      required: true,
    });
    const updated = (await listBodyFieldDefs())[0];
    expect(updated.label).toBe('Room number');
    expect(updated.required).toBe(true);

    await deleteBodyFieldDef(field.id as number);
    expect(await listBodyFieldDefs()).toEqual([]);
  });

  it('refuses an empty label or type', async () => {
    await expect(
      addBodyFieldDef({ label: '', appliesToTypeLabel: 'club', required: false }),
    ).rejects.toThrow(BodyVocabError);
    await expect(
      addBodyFieldDef({ label: 'Room', appliesToTypeLabel: '  ', required: false }),
    ).rejects.toThrow(BodyVocabError);
  });

  it('refuses a second field with the same label on the same type label', async () => {
    await addBodyFieldDef({ label: 'Room', appliesToTypeLabel: 'club', required: false });

    await expect(
      addBodyFieldDef({ label: 'room', appliesToTypeLabel: 'Club', required: true }),
    ).rejects.toThrow(BodyVocabError);

    // The same label on a different type is fine — it is a different field.
    await expect(
      addBodyFieldDef({ label: 'Room', appliesToTypeLabel: 'team', required: false }),
    ).resolves.toMatchObject({ label: 'Room', appliesToTypeLabel: 'team' });
  });

  it('refuses updating a field onto another field’s (label, type)', async () => {
    await addBodyFieldDef({ label: 'Room', appliesToTypeLabel: 'club', required: false });
    const advisor = await addBodyFieldDef({
      label: 'Advisor',
      appliesToTypeLabel: 'club',
      required: false,
    });

    await expect(
      updateBodyFieldDef(advisor.id as number, {
        label: 'Room',
        appliesToTypeLabel: 'club',
        required: false,
      }),
    ).rejects.toThrow(BodyVocabError);
  });

  it('renaming a field label moves the stored value on every matching body, and only those', async () => {
    const field = await addBodyFieldDef({
      label: 'Advisor',
      appliesToTypeLabel: 'club',
      required: false,
    });
    const club = await createBody({ name: 'Robotics', typeLabel: 'club' });
    await updateBodyCustomFields(club.id as number, { Advisor: 'a@b.org' });
    const otherClub = await createBody({ name: 'Debate', typeLabel: 'club' });
    const team = await createBody({ name: 'Track', typeLabel: 'team' });

    await updateBodyFieldDef(field.id as number, {
      label: 'Faculty advisor',
      appliesToTypeLabel: 'club',
      required: false,
    });

    const bodies = await listBodies();
    expect(bodies.find((b) => b.id === club.id)?.customFields).toEqual({
      'Faculty advisor': 'a@b.org',
    });
    expect(bodies.find((b) => b.id === otherClub.id)?.customFields ?? {}).toEqual({});
    expect(bodies.find((b) => b.id === team.id)?.customFields ?? {}).toEqual({});
  });

  it('migrates the stored key on a casing-only field rename too, not just a spelling change', async () => {
    const field = await addBodyFieldDef({
      label: 'Advisor',
      appliesToTypeLabel: 'club',
      required: false,
    });
    const club = await createBody({ name: 'Robotics', typeLabel: 'club' });
    await updateBodyCustomFields(club.id as number, { Advisor: 'a@b.org' });

    await updateBodyFieldDef(field.id as number, {
      label: 'advisor',
      appliesToTypeLabel: 'club',
      required: false,
    });

    const saved = (await listBodies()).find((b) => b.id === club.id);
    expect(saved?.customFields).toEqual({ advisor: 'a@b.org' });
  });
});

describe('body custom fields', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

  it('saves values and enforces a required field for the body’s own type label', async () => {
    await addBodyFieldDef({
      label: 'Advisor email',
      appliesToTypeLabel: 'club',
      required: true,
    });
    const body = await getActiveBody();

    await expect(
      updateBodyCustomFields(body.id as number, {}),
    ).rejects.toThrow(BodyVocabError);

    const saved = await updateBodyCustomFields(body.id as number, {
      'Advisor email': 'advisor@stjohnschs.org',
    });
    expect(saved.customFields).toEqual({ 'Advisor email': 'advisor@stjohnschs.org' });
  });

  it('ignores a required field defined for a different type label', async () => {
    await addBodyFieldDef({
      label: 'Budget code',
      appliesToTypeLabel: 'Branch',
      required: true,
    });
    const body = await getActiveBody();

    const saved = await updateBodyCustomFields(body.id as number, {});
    expect(saved.customFields).toEqual({});
  });

  it('trims values and drops blanks', async () => {
    const body = await getActiveBody();

    const saved = await updateBodyCustomFields(body.id as number, {
      Notes: '  hello  ',
      Empty: '   ',
    });
    expect(saved.customFields).toEqual({ Notes: 'hello' });
  });

  it('createBody drops a custom-field value that does not belong to the body’s own type', async () => {
    await addBodyFieldDef({ label: 'Coach', appliesToTypeLabel: 'team', required: false });
    await addBodyFieldDef({ label: 'Room', appliesToTypeLabel: 'club', required: false });

    // Simulates a UI that drafted "Coach" while the type field read "team"
    // and then switched the type to "club" without clearing it.
    const club = await createBody({
      name: 'Debate',
      typeLabel: 'club',
      customFields: { Coach: 'stale from a different type draft', Room: '  204  ' },
    });

    expect(club.customFields).toEqual({ Room: '204' });
  });
});
