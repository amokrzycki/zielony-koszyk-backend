export function formatDate(date: Date): string {
  // Extract individual components of the date and time
  const day = String(date.getDate()).padStart(2, '0'); // Ensure two digits for the day
  const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are zero-based
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0'); // Ensure two digits for the hours
  const minutes = String(date.getMinutes()).padStart(2, '0'); // Ensure two digits for the minutes
  const seconds = String(date.getSeconds()).padStart(2, '0'); // Ensure two digits for the seconds

  // Return formatted string
  return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
}
