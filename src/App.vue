<script setup>
import PhoneWidget from './components/PhoneWidget.vue';

const phoneNumbers = [
  { name: 'Alice Smith', number: '1001' },
  { name: 'Bob Jones', number: '10003' },
  { name: 'Customer Support', number: '02130208149' },
];

const callNumber = (number) => {
    if (window.handlePhoneCall) {
        window.handlePhoneCall(number);
    }
};
</script>

<template>
  <div class="min-h-screen bg-gray-100 flex flex-col">
    <!-- Navigation (Demo) -->
    <nav class="bg-white shadow-sm px-6 py-4 flex justify-between items-center">
        <div class="font-bold text-xl text-blue-600">CompanyCRM</div>
        <div class="flex space-x-4">
            <span class="text-gray-500">Dashboard</span>
            <span class="text-gray-500">Contacts</span>
            <span class="text-gray-900 font-medium">Settings</span>
        </div>
    </nav>

    <!-- Main Content -->
    <main class="flex-1 p-8">
        <div class="max-w-4xl mx-auto">
            <h1 class="text-3xl font-bold text-gray-900 mb-6">Contact List</h1>
            <div class="bg-white rounded-xl shadow overflow-hidden">
                <table class="min-w-full divide-y divide-gray-200">
                    <thead class="bg-gray-50">
                        <tr>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Phone</th>
                            <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                        </tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-200">
                        <tr v-for="contact in phoneNumbers" :key="contact.number" class="hover:bg-gray-50 transition-colors">
                            <td class="px-6 py-4 whitespace-nowrap">
                                <div class="flex items-center">
                                    <div class="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold">
                                        {{ contact.name.charAt(0) }}
                                    </div>
                                    <div class="ml-4">
                                        <div class="text-sm font-medium text-gray-900">{{ contact.name }}</div>
                                    </div>
                                </div>
                            </td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                Employee
                            </td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-blue-600 cursor-pointer hover:underline" @click="callNumber(contact.number)">
                                {{ contact.number }}
                            </td>
                            <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                <button @click="callNumber(contact.number)" class="text-blue-600 hover:text-blue-900 bg-blue-50 px-3 py-1 rounded-md">Call</button>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div class="mt-8 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <h3 class="font-medium text-yellow-800">Instructions</h3>
                <p class="text-sm text-yellow-700 mt-1">1. Click the "Online/Offline" indicator on the bottom right widget to expand if minimized.</p>
                <p class="text-sm text-yellow-700">2. Enter your SIP credentials (User, Password, SIP Domain, WebSocket URL).</p>
                <p class="text-sm text-yellow-700">3. Once connected, click any phone number in the table above to initiate a call.</p>
            </div>
        </div>
    </main>

    <PhoneWidget />
  </div>
</template>
