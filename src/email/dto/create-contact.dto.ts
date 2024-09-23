import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class CreateContactDto {
  @IsString()
  @IsNotEmpty({ message: 'Enter your first name' })
  firstName: string;

  @IsString()
  @IsNotEmpty({ message: 'Enter your last name' })
  lastName: string;

  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'Write a message' })
  message: string;
}
