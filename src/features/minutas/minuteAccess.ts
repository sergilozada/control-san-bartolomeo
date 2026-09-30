import { EmailAuthProvider, reauthenticateWithCredential, type User } from 'firebase/auth';

export async function unlockMinutes(user: User, password: string): Promise<void> {
  if (!user.email) throw new Error('La cuenta no tiene correo electrónico.');
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
}
