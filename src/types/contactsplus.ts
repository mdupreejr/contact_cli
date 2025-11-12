export interface ContactsPlusConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  apiBase: string;
  authBase: string;
  scopes: string;
}

export interface OAuthTokens {
  access_token: string;
  refresh_token: string;
  access_token_expiration: number;
  access_token_expiration_date: string;
  refresh_token_expiration: number;
  refresh_token_expiration_date: string;
  scope: string;
}

export interface ContactAddress {
  type?: string;
  street?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  extendedAddress?: string;
}

export interface ContactEmail {
  type?: string;
  value: string;
}

export interface ContactPhoneNumber {
  type?: string;
  value: string;
}

export interface ContactName {
  givenName?: string;
  familyName?: string;
  middleName?: string;
  prefix?: string;
  suffix?: string;
}

export interface ContactOrganization {
  name?: string;
  department?: string;
  title?: string;
  location?: string;
  description?: string;
  startDate?: any;
  endDate?: any;
}

export interface ContactUrl {
  type?: string;
  value: string;
  username?: string;
  userId?: string;
}

export interface ContactDate {
  type?: string;
  month?: number;
  day?: number;
  year?: number;
}

export interface ContactRelatedPerson {
  type?: string;
  value: string;
}

export interface ContactIM {
  type?: string;
  value: string;
}

export interface ContactItem {
  type?: string;
  value: string;
}

export interface ContactData {
  addresses?: ContactAddress[];
  birthday?: ContactDate;
  dates?: ContactDate[];
  emails?: ContactEmail[];
  name?: ContactName;
  phoneNumbers?: ContactPhoneNumber[];
  relatedPeople?: ContactRelatedPerson[];
  organizations?: ContactOrganization[];
  urls?: ContactUrl[];
  notes?: string;
  items?: ContactItem[];
  ims?: ContactIM[];
}

export interface ContactMetadata {
  businessCardTranscriptionStatus?: string;
  companyContact?: boolean;
  tagIds: string[];
  sharedBy: string[];
  ownedBy?: string;
}

export interface Contact {
  contactId: string;
  teamId?: string;
  etag: string;
  created: string;
  updated: string;
  contactData: ContactData;
  contactMetadata: ContactMetadata;
}

export interface ContactsResponse {
  contacts: Contact[];
  cursor?: string;
}

export interface ScrollContactsRequest {
  size?: number;
  scrollCursor?: string;
  includeDeletedContacts?: boolean;
  teamId?: string;
}

export interface SearchContactsRequest {
  searchQuery: string;
  searchCursor?: string;
  tagIds?: string[];
  teamId?: string;
}

export interface AccountInfo {
  accountId: string;
  created: string;
  updated: string;
  profileData: ContactData;
}