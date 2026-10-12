import { IsEmail, IsNotEmpty, IsString, Matches } from 'class-validator';

export class CreateContactDto {
  @IsString()
  @IsNotEmpty({ message: 'First name is required' })
  firstName: string;

  @IsString()
  @IsNotEmpty({ message: 'Last name is required' })
  lastName: string;

  @IsNotEmpty({ message: 'Email address is required' })
  @IsEmail({}, { message: 'Email address must be valid' })
  email: string;

  @IsNotEmpty({ message: 'Phone number is required' })
  @Matches(/^\+?[0-9\s\-()]{7,20}$/, {
    message: 'Phone number must be valid',
  })
  phone: string;

  @IsString()
  @IsNotEmpty({ message: 'Message is required' })
  message: string;

  @IsString()
  @IsNotEmpty({ message: 'Please complete the captcha' })
  captchaToken: string;
}
